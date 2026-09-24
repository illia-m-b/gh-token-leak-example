/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Illia Brashkin
 * SPDX-License-Identifier: MIT
 */

import { getBooleanInput, getInput, info, setSecret } from '@actions/core';

const shouldMask = getBooleanInput('should-mask', { required: true });
const token = getInput('github-token', { required: true });
if (shouldMask) {
  setSecret(token);
}
info(`GitHub token value: ${token}`);
