-- Table creation with basic constraints
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(100) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert multiple rows with spacing issues
INSERT INTO
  users (username, email)
VALUES
  ('alice', 'alice@example.com'),
  ('bob', 'bob@example.com');

-- Select with JOIN, WHERE, GROUP BY, ORDER BY
SELECT
  u.id,
  u.username,
  COUNT(p.id) AS post_count
FROM
  users u
  LEFT JOIN posts p ON p.user_id = u.id
WHERE
  u.created_at > '2023-01-01'
GROUP BY
  u.id,
  u.username
ORDER BY
  post_count DESC;

-- Update using subquery
UPDATE users
SET
  email = u.username || '@newdomain.com'
FROM
  (
    SELECT
      id,
      username
    FROM
      users
  ) AS u
WHERE
  users.id = u.id;

-- Delete rows based on a date condition
DELETE FROM sessions
WHERE
  last_activity < DATE('now', '-30 day');

-- Nested SELECT using inline subqueries
SELECT
  u.username,
  (
    SELECT
      COUNT(*)
    FROM
      posts p
    WHERE
      p.user_id = u.id
  ) AS total_posts
FROM
  users u
WHERE
  u.email IS NOT NULL;

-- Simple function-style logic as a reusable SELECT
SELECT
  CASE
    WHEN EXISTS (
      SELECT
        1
      FROM
        sessions
      WHERE
        user_id = 1
        AND active = 1
    ) THEN 'active'
    ELSE 'inactive'
  END AS status;
