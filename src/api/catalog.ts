import { getRawEventTemplateCatalog } from "../raw-events/catalog.ts";

export interface SignalTemplateCatalogResponse {
  generated_at: string;
  basic: {
    raw_events: ReturnType<typeof getRawEventTemplateCatalog>;
  };
  advanced: {
    raw_events: ReturnType<typeof getRawEventTemplateCatalog>;
  };
}

export function buildSignalTemplateCatalogResponse(): SignalTemplateCatalogResponse {
  const templates = getRawEventTemplateCatalog();

  return {
    generated_at: new Date().toISOString(),
    basic: {
      raw_events: templates.filter((template) => template.category === "basic"),
    },
    advanced: {
      raw_events: templates.filter((template) => template.category === "advanced"),
    },
  };
}
