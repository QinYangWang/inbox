// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { DomainConfigDO } from "./domain-config";

export interface Env extends Cloudflare.Env {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
	DOMAIN_CONFIG: DurableObjectNamespace<DomainConfigDO>;
	/** Random high-entropy secrets used to encrypt server-generated private keys. */
	DOMAIN_ENCRYPTION_MASTER_V1?: string;
	DOMAIN_ENCRYPTION_MASTER_V2?: string;
}
