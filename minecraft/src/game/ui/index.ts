// Mount every screen inside <GuiRoot guiScale={settings.guiScale}>; children lay out in vanilla GUI pixels.
// Render <Crosshair scale={...}/> outside GuiRoot so its difference blend reaches the game canvas.

export { GuiRoot, Text, computeGuiScale, useGui, type GuiSize, type TextProps } from "./gui";
export { Button, Slider, TextField, Screen, ListArea, setUiClickSound, useKeyDown, type ButtonProps, type SliderProps, type TextFieldProps } from "./widgets";
export { TitleScreen, SPLASHES, type TitleScreenProps } from "./title-screen";
export { SelectWorldScreen, CreateWorldScreen, ConfirmScreen, seedFromString, type WorldListEntry, type NewWorldOptions, type SelectWorldScreenProps, type CreateWorldScreenProps } from "./world-screens";
export { LoadingScreen, PauseScreen, DeathScreen, type LoadingScreenProps, type PauseScreenProps, type DeathScreenProps } from "./menus";
export { OptionsScreen, type OptionsScreenProps } from "./options-screen";
export { DEFAULT_SETTINGS, KEY_BINDS, type Settings } from "./settings";
export { Chat, LeaveBedButton, type ChatMessage, type ChatProps } from "./chat";
export { Hud, Crosshair, DebugOverlay, type HudProps, type TimedText } from "./hud";
export { ContainerScreen, OUTSIDE, type ContainerScreenProps } from "./container-screen";
export { type CreativeProps } from "./creative-screen";
export { ItemIcon, itemName, tooltipLines } from "./item-icon";
export { runCommand, completeCommand, suggestCommand, setPlayerName, enchantTargets, xpForLevel } from "./commands";
export { EFFECTS, ENCHANTS, enchantName } from "./data";
export { textWidth, wrapText, stripCodes, parseRuns, rasterText } from "./font";
