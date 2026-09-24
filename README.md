# Why your GitHub Action leaks tokens—and why `setSecret()` is non-negotiable

A proof-of-concept that demonstrates how a missing `core.setSecret()` call in a
custom GitHub Action silently prints credentials in plain text to workflow
logs—even when the token is passed through an input.

> [!CAUTION]
> The hard-coded token in this repo (`ghp_EXAMPLE…`) is **intentionally fake**.
Never commit real credentials. This repo exists solely to illustrate the
vulnerability pattern.

## The Problem

Custom GitHub Actions receive tokens via `inputs`. A natural assumption is:

> *"GitHub masks secrets automatically, so I don't need to do anything."*

**Wrong.** GitHub only masks values it *knows* are secrets—that is, values
stored in **Settings/Secrets** and referenced with `${{ secrets.* }}`. If a
caller passes a token through *any other mechanism*, GitHub has no idea it's
sensitive:

```yaml
# This token is NOT in GitHub Secrets—GitHub will NOT mask it.
- uses: your-org/your-action@v1
  with:
    github-token: ghp_HARDCODED_TOKEN_1234567890abcdef
```

When the action then does:

```typescript
import { getInput, info } from '@actions/core';

const token = getInput('github-token', { required: true });
info(`Token: ${token}`); // Printed in plain text in the logs
```

The full token is visible to **anyone who can see the workflow logs**.

## "But who would hard-code a token?"

More people than you think:

- Quick prototype / "I'll fix it later".
- Copy-pasted from a tutorial or Stack Overflow answer.
- CI for a personal fork with a fine-grained PAT.
- Bot account token shared across an org.
- Migration from another CI where env-vars were the norm.

**You cannot control how callers use your action.** You *can* control whether
your action leaks what they give you.

## "Private repo—logs are private too, right?"

This is the most common counterargument, and it falls apart under scrutiny:

| Concern                           | Why it still matters                                                                                                           |
|-----------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| **Collaborator access**           | Every repo collaborator can view workflow logs. One disgruntled or compromised collaborator = leaked token.                    |
| **Log forwarding & SIEM**         | Many orgs ship Actions logs to Datadog, Splunk, or ELK. The token now lives in a *second* system with its own access controls. |
| **Support bundles & screenshots** | Developers paste log snippets in issues, Slack, or vendor support tickets every day.                                           |
| **Log retention**                 | GitHub retains logs for up to 90 days. The token persists long after the workflow run is forgotten.                            |
| **Repo visibility changes**       | A repo that is private *today* may become public *tomorrow*—and log history goes with it.                                      |

> [!IMPORTANT]
> **Defense in depth means you protect the secret at *every* layer**, not just
the outermost one. `core.setSecret()` is the action-layer guardrail—skip it and
you're betting your security on every other layer being perfect.

## "Public repo—the token is in the `.yml` file anyway"

True: if someone hard-codes a real token in a public repo's workflow file, the
source is already exposed. But `core.setSecret()` still matters:

1. **Logs have a larger audience than source.** External contributors trigger CI
   on public repos via pull requests. Depending on permissions
   (`pull_request_target`, fork policies, etc.), those logs may be visible to
   people without commit access.
2. **Logs are indexed differently.** Automated scanners and secret-detection
   tools scrape logs, artifacts, and API responses—not just git history.
3. **Blast radius containment.** Even if the source is compromised, masking the
   token in logs limits *where else* the credential appears, slowing down
   lateral movement and giving revocation a head start.
4. **Workflow runs can be shared.** A link to a specific workflow run can be
   shared publicly. If the token is masked, the shared link is safe.

## The Fix: One Line

Register every sensitive input with [
`core.setSecret()`](https://github.com/actions/toolkit/tree/main/packages/core#setting-a-secret)
**immediately** after reading it:

```typescript
import { getInput, info, setSecret } from '@actions/core';

const token = getInput('github-token', { required: true });
setSecret(token); // GitHub will now mask this value everywhere in logs
info(`Token: ${token}`);
```

That's it. One function call. Zero performance cost. Complete log masking.

> [!TIP]
> **Rule of thumb for action authors:** if an input *could* be sensitive, call
`setSecret()`. There is no downside to masking a non-secret value, but there is
catastrophic downside to *not* masking a secret one.

## Live Demo

This repo is its own proof-of-concept.
The [dogfooding workflow](.github/workflows/dogfooding.yml) runs the action
twice via a build matrix:

| `should-mask` | What happens                                                   |
|---------------|----------------------------------------------------------------|
| `true`        | `setSecret(token)` is called; token is masked in logs          |
| `false`       | `setSecret(token)` is **skipped**; token printed in plain text |

### Action source ([`src/index.ts`](src/index.ts))

```typescript
import { getBooleanInput, getInput, info, setSecret } from '@actions/core';

const shouldMask = getBooleanInput('should-mask', { required: true });
const token = getInput('github-token', { required: true });
if (shouldMask) {
  setSecret(token);
}
info(`GitHub token value: ${token}`);
```

### Workflow

See [`.github/workflows/dogfooding.yml`](.github/workflows/dogfooding.yml).

```yaml
jobs:
  dogfooding:
    name: '(should-mask: ${{ matrix.should-mask }})'
    strategy:
      matrix:
        should-mask: [ 'true', 'false' ]
    runs-on: ubuntu-slim
    steps:
      - uses: actions/checkout@v7
      - uses: ./
        with:
          github-token: ghp_EXAMPLETOKEN1234567890abcdefghijklm
          should-mask: ${{ matrix.should-mask }}
```

Check the
[**Actions**](https://github.com/illia-m-b/gh-token-leak-example/actions) tab to
see the difference yourself.

## Key Takeaways

1. **`core.setSecret()` is not optional**—it's the action author's
   responsibility to mask sensitive inputs.
2. **You don't control your callers.** Assume tokens *will* be hard-coded,
   passed via environment variables, or otherwise supplied outside of GitHub
   Secrets.
3. **Private repos aren't private enough.** Logs leak through collaborators, log
   forwarding, screenshots, and visibility changes.
4. **Public repo exposure has layers.** Even if source is compromised, masking
   limits the blast radius across logs, artifacts, and shared run links.
5. **There is zero cost to calling `setSecret()`.** There is potentially
   unbounded cost to not calling it.

## License

[MIT](LICENSE.txt) &copy; 2026 [Illia Brashkin](https://github.com/illia-m-b)
