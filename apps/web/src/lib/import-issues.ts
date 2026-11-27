import { type ImportIssue, wilayaLabel } from '@erp/shared';

/**
 * The values a row issue message can name. Each has a default, so that a message never
 * fails to render when the API leaves one out.
 */
export function issueParams(issue: ImportIssue, locale: string): Record<string, string | number> {
  const params = {
    row: '',
    max: '',
    value: '',
    name: '',
    qty: '',
    rule: '',
    wilaya: '',
    commune: '',
    ...issue.params,
  };
  // "55 Touggourt": the API's French name, shown in the screen's language.
  if (issue.code === 'location_former_wilaya') {
    const code = Number.parseInt(String(params.wilaya), 10);
    return { ...params, wilaya: wilayaLabel(code, locale) ?? params.wilaya };
  }
  return params;
}
