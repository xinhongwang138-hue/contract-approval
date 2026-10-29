import "dotenv/config";
import path from "node:path";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

process.env.STORAGE_DIR = path.resolve(process.cwd(), "tests/.tmp/storage");
