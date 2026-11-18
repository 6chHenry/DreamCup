import DreamDetailPage from "@/components/DreamDetail";
import { isVercelDeployment } from "@/lib/deployment";

export default function DreamPage() {
  return <DreamDetailPage online={isVercelDeployment()} />;
}
