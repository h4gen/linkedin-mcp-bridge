// Legacy write-journal transport fixtures run against an existing, source-
// verified chat. First contact is separately exercised through the real composer.
export const verifiedChat = "urn:li:msg_conversation:journal-fixture";
export function withVerifiedChat(fetch: (r: any) => Promise<any>) {
  return (r: any) =>
    r.path?.includes("messengerMessages.") &&
    r.path.includes(encodeURIComponent(verifiedChat))
      ? Promise.resolve({
          included: [
            {
              entityUrn: verifiedChat,
              participants: [{ hostIdentityUrn: "urn:li:fsd_profile:friend" }],
            },
          ],
          data: { elements: [] },
        })
      : fetch(r);
}
