import { profileReader, readProfileRelationship } from "./profile-reader.js";
import { beginDomSession, bindDomSession } from "./dom-session.js";
import { domOperation } from "./dom.js";
import { extractionOperation } from "./extraction.js";
import { postContext } from "./post-context.js";
// Static extension bundle in ISOLATED world; never accepts executable caller input.
const operations = new Set([
  "feed_list",
  "posts_search",
  "profile_posts_list",
  "post_resolve",
  "post_get",
  "post_like",
  "post_comment",
  "comments_list",
  "reactions_list",
  "invitation_respond",
  "invitation_withdraw",
  "conversation_delete",
]);
(window as any).__liBridgeAdapters = async (
  op: string,
  a: Record<string, any>,
  state: Record<string, any>,
) => {
  if (op === "profile_read") return profileReader(a.profile_url, a.profile_urn);
  if (op === "profile_relationship")
    return readProfileRelationship(a.profile_url, a.profile_urn);
  if (op === "session_begin") {
    beginDomSession(a.token);
    if (!a.preparing) bindDomSession(a.token);
    return { initialized: true };
  }
  if (op === "post_context") {
    try {
      const c = postContext(a.post_urn);
      return { matched: true, identities: c.identities };
    } catch (e) {
      return {
        bridge_error: (e as Error).message,
        details: (e as any).details,
      };
    }
  }
  if (!operations.has(op))
    return { bridge_error: "unsupported_page_operation" };
  return ["comments_list", "reactions_list"].includes(op)
    ? extractionOperation(op, a, state)
    : domOperation(op, a, state);
};
