import { engineProc } from "./audio-engine-dsp";
import { musicProc } from "./audio-music";
import { INST, musicSynth } from "./audio-music-synth";
import { musicStyles } from "./audio-music-styles";
import { workletSource } from "./audio-worklet";

let src = "";
export const workletCode = () =>
  (src ||= workletSource(
    [
      ["SYN", musicSynth, "sampleRate"],
      ["STY", musicStyles, `${JSON.stringify(INST)}, sampleRate`],
    ],
    [engineProc, musicProc],
  ));
