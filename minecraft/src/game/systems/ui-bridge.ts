// game.ts points these at the page UI. Systems call them; they do nothing before the game wires them.

export type ToastKind = "task" | "goal" | "challenge";
export interface Toast {
  title: string;
  icon: string; // item name
  kind: ToastKind;
}

export const uiBridge = {
  toast: (_t: Toast) => {},
  credits: () => {},
};
