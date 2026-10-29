export type SportInfo = {
  slug: string;
  name: string;
  emoji: string;
  facilities: string[];
  kit: string[];
  pitch: string;
};

export const sports: SportInfo[] = [
  {
    slug: "football",
    name: "Football",
    emoji: "⚽",
    facilities: ["Natural grass & artificial turf pitches", "Futsal courts", "Floodlit fields"],
    kit: ["Balls", "Cones & mannequins", "Bibs", "Goals"],
    pitch: "Run academies by age group: U8 to seniors, with squad chats, match-day sessions and parents kept in the loop.",
  },
  {
    slug: "padel",
    name: "Padel",
    emoji: "🎾",
    facilities: ["Indoor & outdoor courts", "Glass & panoramic courts"],
    kit: ["Rackets for hire", "Ball tubes", "Ball machines"],
    pitch: "Fill every court hour with clinics, private lessons and leagues, with kit reserved alongside the court.",
  },
  {
    slug: "tennis",
    name: "Tennis",
    emoji: "🥎",
    facilities: ["Clay, hard & grass courts", "Lit courts for evening play"],
    kit: ["Ball hoppers", "Ball machines", "Rackets"],
    pitch: "Lessons, junior programmes and cardio tennis, with coaches paid automatically per session.",
  },
  {
    slug: "fitness",
    name: "Fitness",
    emoji: "🏋️",
    facilities: ["Gyms", "Studios", "Tracks & pools"],
    kit: ["Kettlebells", "Bikes & rowers", "Mats"],
    pitch: "Classes with seat limits, waitlists and automatic refunds when members cancel in time.",
  },
  {
    slug: "basketball",
    name: "Basketball",
    emoji: "🏀",
    facilities: ["Indoor courts", "Half-court sessions"],
    kit: ["Balls", "Shot trackers", "Bibs"],
    pitch: "Team practices, skills camps and age-group leagues, with attendance and ratings per player.",
  },
  {
    slug: "multi-sport",
    name: "Multi-sport clubs",
    emoji: "🏟️",
    facilities: ["Mixed facilities", "Multipurpose halls"],
    kit: ["Shared equipment pools"],
    pitch: "One club account for every sport you offer, with shared equipment and one view of the whole business.",
  },
];
