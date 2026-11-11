import { PersonalLoadingFrame } from "@/components/NavSkeleton";

// Personal-side loading frame (emerald chrome matching PersonalNav): paints instantly on PWA open and on
// every tab/month switch, with the tapped tab lit and shimmering cards where the content will land.
export default function Loading() {
  return <PersonalLoadingFrame />;
}
