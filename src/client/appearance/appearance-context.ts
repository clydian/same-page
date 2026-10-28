import { createContext, useContext } from "react";
import { defaultAppearance } from "./appearance-store";
export const AppearanceContext = createContext({ preferences: defaultAppearance, owner: "guest", dark: false });
export function useAppearance() { return useContext(AppearanceContext); }
