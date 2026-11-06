import type { StudioDropdownProps } from './ui';

/** Keep group headings, unavailable choices and supporting text in the canonical picker. */
export function studioDropdownGroups(groups: StudioDropdownProps['groups']) {
  return groups.map(group => ({
    heading: group.label?.trim() || group.id,
    options: group.options.map(option => ({
      value: option.value,
      label: option.supportingText ? `${option.label} (${option.supportingText})` : option.label,
      ...(option.disabled === undefined ? {} : { disabled: option.disabled }),
    })),
  }));
}
