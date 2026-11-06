/** The 40 bundled text effect presets: section 2 of `text-and-titles/catalog.md`, row for row. An absent key disables that feature. */
export type TextPreset = {
  id: string; name: string; group: "Basic" | "Outline" | "Shadow" | "Neon" | "Gradient"; color: string;
  gradient?: { color: string; angle: number };
  stroke?: { color: string; width: number; position: "outside" | "center" };
  shadow?: { color: string; opacity: number; blur: number; distance: number; angle: number };
  glow?: { color: string; intensity: number; radius: number };
};
export const TEXT_PRESET_GROUPS = ["Basic", "Outline", "Shadow", "Neon", "Gradient"] as const;
export const TEXT_PRESETS: readonly TextPreset[] = [
  {id: "plain-white", name: "Plain white", group: "Basic", color: "#ffffff"},
  {id: "plain-black", name: "Plain black", group: "Basic", color: "#000000"},
  {id: "soft-shadow", name: "Soft shadow", group: "Basic", color: "#ffffff", shadow: {color: "#000000", opacity: 60, blur: 20, distance: 6, angle: -45}},
  {id: "hard-shadow", name: "Hard shadow", group: "Basic", color: "#ffffff", shadow: {color: "#000000", opacity: 100, blur: 0, distance: 8, angle: -45}},
  {id: "yellow-pop", name: "Yellow pop", group: "Basic", color: "#ffd400", stroke: {color: "#000000", width: 8, position: "outside"}},
  {id: "red-alert", name: "Red alert", group: "Basic", color: "#ff3b30", stroke: {color: "#ffffff", width: 6, position: "outside"}},
  {id: "ink", name: "Ink", group: "Basic", color: "#111111", stroke: {color: "#ffffff", width: 8, position: "outside"}},
  {id: "paper", name: "Paper", group: "Basic", color: "#fff8e7", shadow: {color: "#5a3e1b", opacity: 50, blur: 12, distance: 4, angle: -60}},
  {id: "outline-black", name: "Black outline", group: "Outline", color: "#ffffff", stroke: {color: "#000000", width: 6, position: "outside"}},
  {id: "outline-white", name: "White outline", group: "Outline", color: "#000000", stroke: {color: "#ffffff", width: 6, position: "outside"}},
  {id: "outline-thick", name: "Thick outline", group: "Outline", color: "#ffffff", stroke: {color: "#000000", width: 14, position: "outside"}},
  {id: "outline-blue", name: "Blue outline", group: "Outline", color: "#ffffff", stroke: {color: "#1e6bff", width: 8, position: "outside"}},
  {id: "outline-pink", name: "Pink outline", group: "Outline", color: "#ffffff", stroke: {color: "#ff2d92", width: 8, position: "outside"}},
  {id: "outline-green", name: "Green outline", group: "Outline", color: "#eaffea", stroke: {color: "#0a8f3c", width: 8, position: "outside"}},
  {id: "hollow-white", name: "Hollow white", group: "Outline", color: "#ffffff00", stroke: {color: "#ffffff", width: 4, position: "center"}},
  {id: "hollow-yellow", name: "Hollow yellow", group: "Outline", color: "#ffffff00", stroke: {color: "#ffd400", width: 4, position: "center"}},
  {id: "drop-long", name: "Long drop", group: "Shadow", color: "#ffffff", shadow: {color: "#000000", opacity: 80, blur: 0, distance: 14, angle: -45}},
  {id: "drop-blue", name: "Blue drop", group: "Shadow", color: "#ffffff", shadow: {color: "#1e6bff", opacity: 100, blur: 0, distance: 8, angle: -45}},
  {id: "drop-pink", name: "Pink drop", group: "Shadow", color: "#ffffff", shadow: {color: "#ff2d92", opacity: 100, blur: 0, distance: 8, angle: -45}},
  {id: "lifted", name: "Lifted", group: "Shadow", color: "#ffffff", shadow: {color: "#000000", opacity: 45, blur: 40, distance: 12, angle: -90}},
  {id: "retro-duo", name: "Retro duo", group: "Shadow", color: "#ffd400", stroke: {color: "#1a1a1a", width: 6, position: "outside"}, shadow: {color: "#ff3b30", opacity: 100, blur: 0, distance: 10, angle: -45}},
  {id: "comic", name: "Comic", group: "Shadow", color: "#ffffff", stroke: {color: "#000000", width: 10, position: "outside"}, shadow: {color: "#000000", opacity: 100, blur: 0, distance: 10, angle: -45}},
  {id: "emboss", name: "Emboss", group: "Shadow", color: "#d9d9d9", shadow: {color: "#ffffff", opacity: 80, blur: 2, distance: 3, angle: 135}},
  {id: "night", name: "Night", group: "Shadow", color: "#cfe3ff", shadow: {color: "#001a4d", opacity: 90, blur: 30, distance: 8, angle: -90}},
  {id: "neon-pink", name: "Neon pink", group: "Neon", color: "#ffe6f4", glow: {color: "#ff2d92", intensity: 80, radius: 30}},
  {id: "neon-blue", name: "Neon blue", group: "Neon", color: "#e6f4ff", glow: {color: "#009dff", intensity: 80, radius: 30}},
  {id: "neon-green", name: "Neon green", group: "Neon", color: "#eaffea", glow: {color: "#34c759", intensity: 80, radius: 30}},
  {id: "neon-yellow", name: "Neon yellow", group: "Neon", color: "#fffbe0", glow: {color: "#ffcc00", intensity: 80, radius: 30}},
  {id: "neon-purple", name: "Neon purple", group: "Neon", color: "#f3e6ff", glow: {color: "#af52de", intensity: 80, radius: 30}},
  {id: "neon-red", name: "Neon red", group: "Neon", color: "#ffe9e6", glow: {color: "#ff3b30", intensity: 80, radius: 30}},
  {id: "neon-tube", name: "Neon tube", group: "Neon", color: "#ffffff00", stroke: {color: "#ffffff", width: 3, position: "center"}, glow: {color: "#00e5ff", intensity: 90, radius: 35}},
  {id: "halo-white", name: "White halo", group: "Neon", color: "#ffffff", glow: {color: "#ffffff", intensity: 60, radius: 45}},
  {id: "sunset", name: "Sunset", group: "Gradient", color: "#ffcc00", gradient: {color: "#ff3b30", angle: 90}},
  {id: "ocean", name: "Ocean", group: "Gradient", color: "#00e5ff", gradient: {color: "#1e6bff", angle: 90}},
  {id: "candy", name: "Candy", group: "Gradient", color: "#ff2d92", gradient: {color: "#af52de", angle: 45}},
  {id: "lime", name: "Lime", group: "Gradient", color: "#d4ff3b", gradient: {color: "#34c759", angle: 90}},
  {id: "gold", name: "Gold", group: "Gradient", color: "#fff2b0", gradient: {color: "#c98a00", angle: 90}, stroke: {color: "#5a3e00", width: 4, position: "outside"}},
  {id: "silver", name: "Silver", group: "Gradient", color: "#ffffff", gradient: {color: "#8e8e93", angle: 90}, stroke: {color: "#2c2c2e", width: 4, position: "outside"}},
  {id: "fire", name: "Fire", group: "Gradient", color: "#ffe600", gradient: {color: "#ff3b30", angle: 90}, glow: {color: "#ff9500", intensity: 60, radius: 25}},
  {id: "aurora", name: "Aurora", group: "Gradient", color: "#34c759", gradient: {color: "#af52de", angle: 0}, shadow: {color: "#000000", opacity: 60, blur: 16, distance: 5, angle: -45}},
] as TextPreset[];
