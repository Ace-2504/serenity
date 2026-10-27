import { redirect } from "next/navigation";

// The overview with recommendations arrives with the findings milestone (M7).
export default function BiHome() {
  redirect("/bi/profitability");
}
