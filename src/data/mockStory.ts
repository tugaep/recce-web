import worldCliffs from "@/assets/world-cliffs.jpg";
import sceneDoor from "@/assets/scene-door.jpg";
import sceneCavern from "@/assets/scene-cavern.jpg";
import sceneStorm from "@/assets/scene-storm.jpg";
import charKeeper from "@/assets/char-keeper.jpg";
import charStranger from "@/assets/char-stranger.jpg";

export type Character = {
  id: string;
  name: string;
  role: string;
  backstory: string;
  traits: string[];
  portrait: string;
};

export type Choice = {
  id: string;
  label: string;
  hint: string;
  next: string;
};

export type Scene = {
  id: string;
  chapter: string;
  title: string;
  image: string;
  narrative: string;
  choices: Choice[];
  ending?: string;
};

export type World = {
  title: string;
  era: string;
  atmosphere: string;
  image: string;
  rules: string[];
};

export const mockWorld: World = {
  title: "The Cliffs of Aelmoor",
  era: "A forgotten autumn, between two centuries",
  atmosphere:
    "Salt-scented winds, lavender dusk, and a sea that never quite sleeps.",
  image: worldCliffs,
  rules: [
    "Light carries memory.",
    "Doors that should not exist always wait for someone.",
    "Promises echo louder than thunder.",
  ],
};

export const mockCharacters: Character[] = [
  {
    id: "keeper",
    name: "Edran Vale",
    role: "The Lighthouse Keeper",
    backstory:
      "Forty winters tending a light no ship has answered in a decade. He keeps the lamp lit anyway.",
    traits: ["Patient", "Haunted", "Stubbornly hopeful"],
    portrait: charKeeper,
  },
  {
    id: "stranger",
    name: "The Stranger",
    role: "Traveler from beyond the door",
    backstory:
      "Arrived with the tide on a moonless night. Speaks in half-finished sentences and old names.",
    traits: ["Mysterious", "Soft-spoken", "Knows your name"],
    portrait: charStranger,
  },
];

export const mockScenes: Record<string, Scene> = {
  start: {
    id: "start",
    chapter: "Chapter I",
    title: "The Door in the Cliff",
    image: sceneDoor,
    narrative:
      "The storm has thinned to a whisper. Edran descends the rope path with his lantern raised, and there — set into the wet black rock — stands a door of pale wood, warm light spilling from beneath it. He has walked these cliffs for forty years. The door has never been here before.\n\nA figure waits beside it, hooded, perfectly still, as if it has been expecting him for a very long time.",
    choices: [
      {
        id: "enter",
        label: "Open the door alone",
        hint: "Step through. Trust whatever waits inside more than what waits beside it.",
        next: "cavern",
      },
      {
        id: "speak",
        label: "Speak to the stranger first",
        hint: "Names have weight here. Learn one before you give yours away.",
        next: "storm",
      },
    ],
  },
  cavern: {
    id: "cavern",
    chapter: "Chapter II",
    title: "The Cavern of Quiet Light",
    image: sceneCavern,
    narrative:
      "The door closes behind you with the soft sound of a held breath released. A vast cavern unfolds — water like polished glass, crystals rising from it that pulse with a soft lavender pulse, in time with your own heart.\n\nAt the far end of the lake, a small wooden boat waits. There are two oars. There is no one to row with you.",
    choices: [
      {
        id: "row",
        label: "Take the boat across",
        hint: "Some doors only open from the other side of a quiet water.",
        next: "ending-light",
      },
      {
        id: "listen",
        label: "Sit and listen to the crystals",
        hint: "If light carries memory, perhaps it will lend you one.",
        next: "ending-memory",
      },
    ],
  },
  storm: {
    id: "storm",
    chapter: "Chapter II",
    title: "What the Sea Knows",
    image: sceneStorm,
    narrative:
      "\"You don't remember me,\" the stranger says, and the wind takes the words gently, as if it has been waiting to. \"That is alright. You weren't supposed to.\"\n\nThe sea below the cliff turns suddenly silver, then still. A single wave begins to climb toward the moon, slowly, as if deciding something on your behalf.",
    choices: [
      {
        id: "ask",
        label: "Ask who they are",
        hint: "Some answers cost the asker. Some are worth that price.",
        next: "ending-name",
      },
      {
        id: "return",
        label: "Turn back to the door",
        hint: "The light is still warm. The stranger will not stop you.",
        next: "cavern",
      },
    ],
  },
  "ending-light": {
    id: "ending-light",
    chapter: "Epilogue",
    title: "The Light You Carried",
    image: sceneCavern,
    narrative:
      "You row until the cavern is only a glow behind you, and then you row a little further. When you finally lift the oars, the boat keeps moving — gently, certainly — toward something that looks, from this distance, almost like home.",
    choices: [],
    ending: "You crossed the quiet water.",
  },
  "ending-memory": {
    id: "ending-memory",
    chapter: "Epilogue",
    title: "A Borrowed Memory",
    image: sceneCavern,
    narrative:
      "The crystals show you a summer you never lived: a child laughing on these very cliffs, a hand in yours, a name you almost remember. When the light fades, you keep the warmth of it. It is enough.",
    choices: [],
    ending: "You listened, and were answered.",
  },
  "ending-name": {
    id: "ending-name",
    chapter: "Epilogue",
    title: "The Name You Were Given",
    image: sceneStorm,
    narrative:
      "The stranger tells you their name, and then yours — the one before the one you use. The wave above the moon finishes its long climb and falls, gently, somewhere very far away. You walk back to the lighthouse together. The lamp does not need lighting tonight.",
    choices: [],
    ending: "You asked. You were answered.",
  },
};

export const startingSuggestions = [
  "A lighthouse keeper discovers a door in the cliffs",
  "Neo-noir Tokyo, 2087",
  "A forgotten desert temple at dawn",
  "A generation ship, three hundred years from home",
];
