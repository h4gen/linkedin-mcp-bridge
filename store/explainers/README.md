# Store gallery explainers

Five 1280 × 800 RGB PNGs in the accepted ivory/navy/cobalt campaign style, generated with built-in image_gen. Four images were selectively refreshed for 0.7.2 on 2026-11-01; publishing is unchanged. Current edit prompts: `refresh-0.7.2-prompts.json`. Original prompts remain in `prompts.json` and `expanded-prompts.json`; earlier artwork remains in Git history. Source images are preserved in `source/`. Export with `export.cjs` and sharp (`NODE_PATH` if needed).

- `upload/inbox-1280x800.png`: chats by person, long messages, replies and organization. Removes the misleading suggestion of full-text message search.
- `upload/feed-1280x800.png`: topic/date post search, comments, reactions and direct profile handoff. Does not promise complete reply trees.
- `upload/people-1280x800.png`: people search, profile/background/current role and author posts for conversation preparation.
- `upload/research-1280x800.png`: connection status, pending invitations and existing personal chats. Replaces the former research/publishing overlap; the filename stays stable for existing references.
- `upload/publishing-1280x800.png`: native text drafts, scheduling and cancellation; unchanged.

These are promotional capability explainers for the store gallery, not screenshots of an application UI. Original popup captures remain in store/screenshots/ as historical source material.

Suggested gallery order: inbox → feed → people → research (relationships) → publishing. The stories explain tasks an agent can compose from primitives, not built-in campaigns, lead scores, CRM state or autonomous monitoring. The SEO title and both promotional tiles stay unchanged. See `../listing.md` for the complete copy and `../SUBMISSION.md` for portal status.
