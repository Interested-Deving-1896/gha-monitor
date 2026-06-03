import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';

// Augmented Octokit class with throttling and retry plugins, built once at
// module level so the class is not reconstructed on every createClient() call.
const ThrottledOctokit = Octokit.plugin(throttling, retry);

/**
 * Create an authenticated Octokit instance with throttling and retry.
 *
 * The throttling plugin's TypeScript types declare the rate-limit callbacks
 * as returning `void`, but the runtime actually uses the return value as a
 * boolean to decide whether to retry. We cast to `unknown` then to the
 * declared `void` type so TypeScript is satisfied while still returning the
 * boolean the runtime needs.
 */
export function createClient(token: string): Octokit {
  return new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, _options, octokit, retryCount) => {
        octokit.log.warn(
          `Rate limit hit, retrying after ${retryAfter}s (attempt ${retryCount + 1})`,
        );
        return (retryCount < 3) as unknown as void;
      },
      onSecondaryRateLimit: (retryAfter, _options, octokit, retryCount) => {
        octokit.log.warn(
          `Secondary rate limit hit, retrying after ${retryAfter}s (attempt ${retryCount + 1})`,
        );
        return (retryCount < 3) as unknown as void;
      },
    },
  });
}

/** Use this type to annotate parameters that accept a GitHub API client. */
export type OctokitClient = Octokit;
