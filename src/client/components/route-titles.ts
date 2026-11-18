export function driveSettingsTitleKey(section: string) {
  return section === "info" ? "basicInfo" : section === "admission" ? "admission" : section === "trash" ? "trash" : "driveSettings";
}
