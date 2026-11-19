import type common from "./messages/zh-Hans/common.json";
import type entry from "./messages/zh-Hans/entry.json";
import type language from "./messages/zh-Hans/language.json";
import type library from "./messages/zh-Hans/library.json";
import type practice from "./messages/zh-Hans/practice.json";
import type reader from "./messages/zh-Hans/reader.json";
import type system from "./messages/zh-Hans/system.json";

type Catalogs = {
  common: typeof common;
  entry: typeof entry;
  language: typeof language;
  library: typeof library;
  practice: typeof practice;
  reader: typeof reader;
  system: typeof system;
};

type MessagePath<Catalog> = Catalog extends object ? {
  [Key in keyof Catalog & string]: Catalog[Key] extends string
    ? Key
    : `${Key}.${MessagePath<Catalog[Key]>}`;
}[keyof Catalog & string] : never;

export type AppFeature = keyof Catalogs;
export type AppMessageKey<Feature extends AppFeature> = MessagePath<Catalogs[Feature]>;
