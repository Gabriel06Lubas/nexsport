import { redirect } from "next/navigation";

/** The athlete area moved to /dashboard/student; old links keep working. */
export default function AthleteHomeRedirect() {
  redirect("/dashboard/student");
}
