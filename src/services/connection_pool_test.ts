
// src/services/connection_pool_test.ts

import { ConnectionPool, Connection } from "./connection_pool.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("ConnectionPool - should create a pool with specified max connections", () => {
  const pool = new ConnectionPool(5);
  assertEquals((pool as any).maxConnections, 5);
});

Deno.test("ConnectionPool - should return a new connection if available connections are empty and max connections not reached", async () => {
  const pool = new ConnectionPool(1);
  const connection = await pool.getConnection();
  assertEquals(connection.id, 1);
});

Deno.test("ConnectionPool - should reuse an available connection", async () => {
  const pool = new ConnectionPool(1);
  const connection1 = await pool.getConnection();
  pool.releaseConnection(connection1);
  const connection2 = await pool.getConnection();
  assertEquals(connection2.id, connection1.id);
});

Deno.test("ConnectionPool - should wait for a connection if max connections reached and none are available", async () => {
  const pool = new ConnectionPool(1);
  const connection1 = await pool.getConnection();

  let connection2: Connection | undefined;
  const promise = pool.getConnection().then((conn) => {
    connection2 = conn;
  });

  // Give some time for the promise to be pending
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(connection2, undefined);

  pool.releaseConnection(connection1);
  await promise;
  assertEquals(connection2!.id, connection1.id);
});
