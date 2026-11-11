import { FamilyLoadingFrame } from "@/components/NavSkeleton";

// Streamed instantly while a page's server data loads (PWA open AND every tab/month switch): the same
// header + bottom bar the page arrives with — tapped tab already lit — and shimmering cards for the body,
// so the frame never blanks and only the content fades in.
export default function Loading() {
  return <FamilyLoadingFrame />;
}
