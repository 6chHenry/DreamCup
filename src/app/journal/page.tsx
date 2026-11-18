import JournalPage from "@/components/JournalPage";
import { isVercelDeployment } from "@/lib/deployment";

export default function JournalRoute() {
  return <JournalPage online={isVercelDeployment()} />;
}
