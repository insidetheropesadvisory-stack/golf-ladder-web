import { connection } from "next/server";
import NewMatchClient from "./NewMatchClient";

export default async function NewMatchPage() {
  await connection();
  return <NewMatchClient />;
}