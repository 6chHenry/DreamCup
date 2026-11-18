import Home from "@/components/DreamCapture";
import { isVercelDeployment } from "@/lib/deployment";

export default function HomePage() {
  return <Home online={isVercelDeployment()} />;
}
