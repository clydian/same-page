import assert from "node:assert/strict";
import { test } from "node:test";

import * as alphaTab from "@coderline/alphatab";

import {
  applyTimbreProfile,
  classifyTimbreRoles,
  TONE_PROFILES,
} from "../src/timbre-profile.ts";

const midiChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

class CaptureMidiHandler {
  programChanges = [];
  addTickShift() {}
  addTimeSignature() {}
  addRest() {}
  addNote() {}
  addControlChange() {}
  addProgramChange(track, tick, channel, program) {
    this.programChanges.push({ track, tick, channel, program });
  }
  addTempo() {}
  addBend() {}
  addNoteBend() {}
  finishTrack() {}
}

// Small authored controls replace the former product catalog dependency.
const loadScore = async (file) => {
  const names = ["Soprano", "Alto", "Tenor", "Bass", ...(file === "momentary.musicxml" ? ["Harp"] : [])];
  const xml = `<score-partwise version="4.0"><part-list>${names.map((name,i)=>`<score-part id="P${i}"><part-name>${name}</part-name><score-instrument id="I${i}"><instrument-name>${name}</instrument-name></score-instrument><midi-instrument id="I${i}"><midi-channel>${midiChannels[i]+1}</midi-channel><midi-program>${name==='Harp'?47:54}</midi-program></midi-instrument></score-part>`).join('')}</part-list>${names.map((name,i)=>`<part id="P${i}"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>`).join('')}</score-partwise>`;
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(xml), settings);
  score.tracks.forEach((track, index) => {
    track.playbackInfo.primaryChannel = midiChannels[index];
    track.playbackInfo.secondaryChannel = midiChannels[index];
  });
  return { score, settings };
};

const instrumentAutomations = (track) =>
  track.staves.flatMap((staff) =>
    staff.bars.flatMap((bar) =>
      bar.voices.flatMap((voice) =>
        voice.beats.flatMap((beat) =>
          beat.automations.filter(
            (automation) => automation.type === alphaTab.model.AutomationType.Instrument,
          ),
        ),
      ),
    ),
  );

const generatedProgramsForTrack = (score, settings, trackIndex) => {
  const handler = new CaptureMidiHandler();
  new alphaTab.midi.MidiFileGenerator(score, settings, handler).generate();
  const channel = score.tracks[trackIndex].playbackInfo.primaryChannel;
  return handler.programChanges
    .filter((event) => event.channel === channel)
    .map((event) => event.program);
};

test("only choir and warm piano are available", () => {
  assert.deepEqual(Object.keys(TONE_PROFILES), ["choir", "warm-piano"]);
});

for (const mode of ["choir", "warm-piano"]) {
  test(`${mode} survives score instrument automation in generated MIDI`, async () => {
    const { score, settings } = await loadScore("as-torrents-in-summer.musicxml");
    const roles = classifyTimbreRoles(
      score.tracks,
      ["Soprano", "Alto", "Tenor", "Bass"],
    );
    applyTimbreProfile(score.tracks, mode, roles);

    assert.deepEqual(roles, ["vocal", "vocal", "vocal", "vocal"]);
    for (const [trackIndex, track] of score.tracks.entries()) {
      assert.equal(track.playbackInfo.program, TONE_PROFILES[mode].program);
      assert.ok(instrumentAutomations(track).length > 0);
      assert.ok(
        instrumentAutomations(track).every(
          (automation) => automation.value === TONE_PROFILES[mode].program,
        ),
      );
      const generatedPrograms = generatedProgramsForTrack(score, settings, trackIndex);
      assert.ok(generatedPrograms.length > 0);
      assert.deepEqual(new Set(generatedPrograms), new Set([TONE_PROFILES[mode].program]));
    }
  });
}

test("harp accompaniment keeps the score's program and automation", async () => {
  const { score, settings } = await loadScore("momentary.musicxml");
  const roles = classifyTimbreRoles(
    score.tracks,
    ["Soprano", "Alto", "Tenor", "Bass", "Harp"],
  );
  const harp = score.tracks[4];
  const originalProgram = harp.playbackInfo.program;
  const originalAutomationValues = instrumentAutomations(harp).map(({ value }) => value);

  applyTimbreProfile(score.tracks, "choir", roles);

  assert.equal(roles[4], "accompaniment");
  assert.equal(harp.playbackInfo.program, originalProgram);
  assert.deepEqual(
    instrumentAutomations(harp).map(({ value }) => value),
    originalAutomationValues,
  );
  assert.deepEqual(
    new Set(generatedProgramsForTrack(score, settings, 4)),
    new Set([originalProgram]),
  );
});

test("unknown and ambiguously named local instruments keep their original timbres", async () => {
  const { score } = await loadScore("as-torrents-in-summer.musicxml");
  const examples = [
    { track: score.tracks[0], name: "Flute", program: 73 },
    { track: score.tracks[1], name: "Electric Bass", program: 33 },
  ];
  for (const example of examples) {
    example.track.name = example.name;
    example.track.playbackInfo.program = example.program;
    const originalAutomationValues = instrumentAutomations(example.track).map(({ value }) => value);
    const roles = classifyTimbreRoles([example.track], []);

    applyTimbreProfile([example.track], "choir", roles);

    assert.deepEqual(roles, ["other"]);
    assert.equal(example.track.playbackInfo.program, example.program);
    assert.deepEqual(
      instrumentAutomations(example.track).map(({ value }) => value),
      originalAutomationValues,
    );
  }
});
