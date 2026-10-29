// A short, human-readable device label for the "Your devices" list.
// Deliberately coarse: it helps users recognise a session, nothing more.

const browsers: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\//, "Firefox"],
  [/CriOS\/|Chrome\//, "Chrome"],
  [/Version\/.*Safari\//, "Safari"],
];

const systems: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = browsers.find(([re]) => re.test(ua))?.[1];
  const os = systems.find(([re]) => re.test(ua))?.[1];
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}
