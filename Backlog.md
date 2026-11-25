# Open outcomes

Outcomes that are not done and must outlive a session. Finished work is in
the Git history; plans and session notes do not belong here.

- Replace the simulator's invented frames (write acknowledgements and the
  battery-voltage reply) with captures.
- A push to `main` whose checks fail is still deployed, because Cloudflare
  does not wait for GitHub. Decide whether to accept that or gate the deploy.
- The Content-Security-Policy is written twice, in `vite.config.ts` and in
  `public/_headers`, and no test holds the two copies equal.
- No translation has been read by a native speaker: Japanese, Chinese
  (simplified and traditional), Korean, Russian, Italian. Have each read, and
  check the feature names against IQOS's own wording in that market.
- Link previews and search results are English for every language, because
  the page has one address. Decide whether each language should get an
  address of its own (`/ja/`, with its own title, description and preview).
