import type { Fetcher } from "./api.js";
import { Fault } from "./contracts.js";
import { collection, normalize } from "./normalize.js";

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function companyUrl(value: unknown) {
  const url = text(value)?.match(
    /^https:\/\/www\.linkedin\.com\/company\/([\w-]+)\/?(?:[?#].*)?$/,
  );
  return url && url[1]
    ? { slug: url[1], canonical: `https://www.linkedin.com/company/${url[1]}/` }
    : null;
}

function companyId(urn: unknown) {
  return text(urn)?.match(
    /(?:^|\()urn:li:(?:fsd_company|fs_normalized_company|fs_miniCompany|company|organization):(\d{1,20})(?=$|[,\)])/,
  )?.[1];
}

export function companySearchHit(row: Record<string, any>) {
  const url = companyUrl(row.navigationUrl);
  const name = text(row.title?.text);
  if (!url || !name) return null;
  const id = companyId(row.entityUrn);
  const urlId = /^\d{1,20}$/.test(url.slug) ? url.slug : undefined;
  if (id && urlId && id !== urlId) throw new Fault("company_identity_mismatch");
  const resolvedId = id ?? urlId;
  if (!resolvedId) throw new Fault("company_identity_unresolved");
  return {
    company_id: resolvedId,
    company_url: url.canonical,
    name,
    industry: text(row.primarySubtitle?.text),
    location: text(row.secondarySubtitle?.text),
  };
}

function webUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export async function companyProfile(id: string, url: string, fetch: Fetcher) {
  const target = companyUrl(url);
  if (!target) throw new Fault("invalid_company_url");
  const numericSlug = /^\d{1,20}$/.test(target.slug);
  if (numericSlug && target.slug !== id)
    throw new Fault("company_identity_mismatch");
  const params = new URLSearchParams({
    decorationId:
      "com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-12",
    ...(numericSlug ? {} : { q: "universalName", universalName: target.slug }),
  });
  const raw = await fetch({
    path: `/organization/companies${numericSlug ? `/${id}` : ""}?${params}`,
  });
  // The search response can include unrelated subsidiary/showcase entities.
  // Resolve the collection roots, or the direct entity for a numeric URL.
  const roots = numericSlug
    ? [normalize(raw).data]
    : collection(raw, "company_get").items;
  if (!roots.length) throw new Fault("company_not_found");
  if (roots.length !== 1) throw new Fault("company_not_unique");
  const company = roots[0];
  const sourceId = companyId(company.entityUrn);
  const name = text(company.name);
  if (!sourceId || !name) throw new Fault("company_profile_shape_changed");
  if (sourceId !== id) throw new Fault("company_identity_mismatch");

  const headquarters = company.headquarter;
  const min = company.staffCountRange?.start;
  const max = company.staffCountRange?.end;
  return {
    company: {
      company_id: sourceId,
      company_url: target.canonical,
      name,
      industry: text(company.companyIndustries?.[0]?.localizedName),
      location:
        [
          headquarters?.city,
          headquarters?.geographicArea,
          headquarters?.country,
        ]
          .map(text)
          .filter(Boolean)
          .join(", ") || null,
      description: text(company.description),
      website: webUrl(company.companyPageUrl),
      size_band:
        Number.isSafeInteger(min) && min > 0
          ? { min, max: Number.isSafeInteger(max) && max >= min ? max : null }
          : null,
    },
  };
}
