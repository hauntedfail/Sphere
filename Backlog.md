# Open outcomes

Outcomes that are not done and must outlive a session. Finished work is in
the Git history; plans and session notes do not belong here.

- Replace the simulator's invented frames (write acknowledgements and the
  battery-voltage reply) with captures.
- A push to `main` whose checks fail is still deployed, because Cloudflare
  does not wait for GitHub. Decide whether to accept that or gate the deploy.
- The Content-Security-Policy is written twice, in `vite.config.ts` and in
  `public/_headers`, and no test holds the two copies equal.
