import { z } from "zod";

// Koi intentionally forbids unsafe-eval. Configure Zod before application modules evaluate so its
// caught Function probe does not surface as a CSP violation in WebMCP-enabled browser sessions.
z.config({ jitless: true });
