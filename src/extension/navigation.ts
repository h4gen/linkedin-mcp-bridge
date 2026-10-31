export function navigationTargetReached(
  tab: { url?: string; pendingUrl?: string },
  target: string,
  previousUrl: string | undefined,
  allowPostRedirect: boolean,
) {
  // Chrome can still report status=complete for the old document after update().
  // Neither that document nor an intermediate redirect is proof of arrival.
  if (tab.pendingUrl || !tab.url) return false;
  if (tab.url === target) return true;
  return (
    allowPostRedirect &&
    tab.url !== previousUrl &&
    /^https:\/\/www\.linkedin\.com\/(feed\/update\/|posts\/)/.test(tab.url)
  );
}
