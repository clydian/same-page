export function driveSettingsTitle(section: string) {
  return section === "info" ? "基本信息" : section === "admission" ? "加入方式" : section === "trash" ? "回收站" : "云盘管理";
}
