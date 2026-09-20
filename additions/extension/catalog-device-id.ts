const CATALOG_UUID_PROPERTY = 'Copilot Catalog UUID';
const CATALOG_UUID_RE = /^[0-9a-f]{32}$/;

export function getCatalogDeviceId(
    otherProperty: Record<string, unknown> | null | undefined,
    fallback: string | null | undefined,
) {
    const tagged = otherProperty?.[CATALOG_UUID_PROPERTY];
    if (typeof tagged === 'string' && CATALOG_UUID_RE.test(tagged)) return tagged;
    return fallback ?? null;
}
