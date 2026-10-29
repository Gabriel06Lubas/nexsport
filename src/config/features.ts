import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  Dumbbell,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type FeatureGroup = {
  id: string;
  icon: LucideIcon;
  title: string;
  summary: string;
  audience: ("Clubs" | "Coaches" | "Athletes")[];
  capabilities: { title: string; detail: string }[];
};

// The complete capability catalogue, grouped the way the product is built
// (one group per domain module). Rendered on /features and summarised on /.
export const featureGroups: FeatureGroup[] = [
  {
    id: "clubs",
    icon: Building2,
    title: "Club & people management",
    summary: "Your club, its sports, squads and every person in it, with the right access for each role.",
    audience: ["Clubs"],
    capabilities: [
      { title: "Club profile", detail: "Branded public page with logo, address, time zone and default currency." },
      { title: "Multi-sport catalogue", detail: "Offer football, padel, tennis, fitness and more from one club account." },
      { title: "Age groups & squads", detail: "Organise athletes into groups such as U10, Juniors or Seniors 50+, per sport." },
      { title: "Member roster", detail: "Invite athletes and track each one as invited, active, suspended or left." },
      { title: "Staff roles & permissions", detail: "Give staff exactly what they need: facilities, schedule, billing, analytics and more." },
      { title: "Coach assignment", detail: "Assign coaches to individual athletes or to whole squads." },
      { title: "Multiple roles per person", detail: "Someone can coach at one club and train at another, or be both staff and coach." },
    ],
  },
  {
    id: "assets",
    icon: Dumbbell,
    title: "Facilities & equipment",
    summary: "Every field, court and studio, and every piece of kit, with live availability.",
    audience: ["Clubs", "Coaches"],
    capabilities: [
      { title: "Facility catalogue", detail: "Pitches, courts, gyms, studios, pools and tracks, with surface, indoor/outdoor, lighting and capacity." },
      { title: "Turnover buffers", detail: "Leave time between bookings for cleaning or setup." },
      { title: "Hourly rates", detail: "Price each facility so utilisation turns into revenue reports." },
      { title: "Equipment inventory", detail: "Stock counts, SKUs, categories and condition, from new to needs repair." },
      { title: "Reserve kit with sessions", detail: "Book 12 ball tubes and the ball machine along with the court." },
      { title: "Check-out & return", detail: "Track what left the store and what came back." },
      { title: "Stock protection", detail: "Stock can't be reduced below what's already reserved for upcoming sessions." },
    ],
  },
  {
    id: "scheduling",
    icon: CalendarClock,
    title: "Scheduling",
    summary: "Create sessions in seconds, and never double-book a court, a machine or a seat.",
    audience: ["Coaches", "Clubs"],
    capabilities: [
      { title: "Session builder", detail: "Pick facility, coach, sport, age group, time, price and capacity in one form." },
      { title: "Recurring series", detail: "Weekly training blocks scheduled in one go." },
      { title: "No double-booking", detail: "Overlapping bookings on a facility are rejected, even when two people book at the same instant." },
      { title: "Equipment availability", detail: "See exactly how many units are free in a time window before you book." },
      { title: "Seat limits", detail: "Sessions never go over capacity; extra athletes join a waitlist." },
      { title: "Smart reschedule", detail: "Moving a session moves its equipment too, or tells you why it can't." },
      { title: "Cancellation", detail: "Cancelling frees the facility and kit, notifies everyone and triggers refunds." },
    ],
  },
  {
    id: "attendance",
    icon: ClipboardCheck,
    title: "Invites, attendance & feedback",
    summary: "From invite to check-in to coaching notes: the full session loop.",
    audience: ["Coaches", "Athletes"],
    capabilities: [
      { title: "Session invites", detail: "Invite individuals or whole squads; athletes accept or decline in one tap." },
      { title: "Waitlists", detail: "When a seat frees up, the next athlete in line can take it." },
      { title: "Attendance tracking", detail: "Mark present, late, absent or excused from your phone at the court." },
      { title: "Performance ratings", detail: "Rate each athlete 1–5 per session and watch progress over time." },
      { title: "Private feedback", detail: "Write notes that only the athlete can see." },
    ],
  },
  {
    id: "payments",
    icon: CreditCard,
    title: "Payments & payouts",
    summary: "Athletes pay per session, and the money is split automatically between the club, the coach and the platform.",
    audience: ["Clubs", "Coaches", "Athletes"],
    capabilities: [
      { title: "Pay per session", detail: "Secure card checkout powered by Stripe." },
      { title: "Stripe Connect payouts", detail: "Clubs and independent coaches get paid into their own Stripe accounts." },
      { title: "Automatic revenue splits", detail: "Set a coach's share once; every payment is divided for you." },
      { title: "Cancellation policies", detail: "Flexible, standard or strict rules, applied automatically when someone cancels." },
      { title: "Automatic refunds", detail: "Refunds follow your policy, and organiser cancellations refund in full." },
      { title: "No double charges", detail: "A seat can only ever have one live payment, even if checkout is retried." },
      { title: "Disputes & chargebacks", detail: "Track every dispute from warning to outcome." },
      { title: "Plans for clubs and coaches", detail: "Monthly plans that lower the platform fee as you grow." },
    ],
  },
  {
    id: "social",
    icon: Sparkles,
    title: "Social network",
    summary: "A home for your sports life: profiles, posts and a feed that celebrates the wins.",
    audience: ["Athletes", "Coaches", "Clubs"],
    capabilities: [
      { title: "Sports profiles", detail: "@handle, bio, photo, cover, location, and the sports you play with your level." },
      { title: "Follow people & clubs", detail: "Private profiles approve each follower first." },
      { title: "Posts with photos & video", detail: "Share results, highlights and training clips." },
      { title: "Audience control", detail: "Post to everyone, followers only, your club, or just yourself." },
      { title: "Likes & threaded comments", detail: "React to posts and reply to comments." },
      { title: "Club pages", detail: "Clubs post news and results to their members and followers." },
    ],
  },
  {
    id: "messaging",
    icon: MessagesSquare,
    title: "Messaging",
    summary: "Direct and group chat between coaches, athletes and teammates.",
    audience: ["Athletes", "Coaches"],
    capabilities: [
      { title: "Direct messages", detail: "One conversation per pair of people, always in the same place." },
      { title: "Squad group chats", detail: "Group chats tied to your club, for a team or training group." },
      { title: "Read status", detail: "Know who has caught up on the latest message." },
      { title: "Mute", detail: "Silence a busy chat for a while without leaving it." },
    ],
  },
  {
    id: "notifications",
    icon: Bell,
    title: "Notifications",
    summary: "The right nudge at the right time, and nothing you don't need.",
    audience: ["Athletes", "Coaches", "Clubs"],
    capabilities: [
      { title: "Session alerts", detail: "Invites, replies, changes, cancellations and reminders." },
      { title: "Payment alerts", detail: "Successful payments, failed payments and refunds." },
      { title: "Social activity", detail: "New followers, follow requests, likes, comments and replies." },
      { title: "Unread badge", detail: "One glance tells you what's new." },
    ],
  },
  {
    id: "analytics",
    icon: BarChart3,
    title: "Dashboard & analytics",
    summary: "The numbers that run a club, in one view.",
    audience: ["Clubs"],
    capabilities: [
      { title: "Revenue", detail: "Session revenue over time, by sport, facility and coach." },
      { title: "Active memberships", detail: "Growth and churn across your member base." },
      { title: "Facility utilisation", detail: "Which courts are full and which hours are empty." },
      { title: "Staff output", detail: "Sessions delivered and athlete ratings per coach." },
    ],
  },
  {
    id: "trust",
    icon: ShieldCheck,
    title: "Security & reliability",
    summary: "Built so the things that must never go wrong can't.",
    audience: ["Clubs", "Coaches", "Athletes"],
    capabilities: [
      { title: "Role-based access", detail: "Five roles (admin, club owner, staff, coach, athlete), each seeing only what it should." },
      { title: "Club data isolation", detail: "One club's courts, kit and sessions can never be linked to another's." },
      { title: "Card data stays with Stripe", detail: "Card numbers never touch nexport's servers." },
      { title: "Guarantees in the database", detail: "Double-booking and over-capacity are blocked at the deepest layer, not just in the app." },
    ],
  },
];
