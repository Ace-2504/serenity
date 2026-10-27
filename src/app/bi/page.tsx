import { redirect } from "next/navigation";

// The dashboard arrives with the analytics milestone; until then imports are the entry point.
export default function BiHome() {
  redirect("/bi/imports");
}
