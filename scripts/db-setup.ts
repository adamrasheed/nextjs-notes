import { close } from "@/db";
import { setupDatabase } from "@/db/setup";

setupDatabase()
  .then(close)
  .then(() => console.log("Database migrated and seeded."));
