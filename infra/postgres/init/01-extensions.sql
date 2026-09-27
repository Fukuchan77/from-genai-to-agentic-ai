CREATE EXTENSION IF NOT EXISTS vector;

\getenv langfuse_db_name LANGFUSE_DB_NAME
SELECT format('CREATE DATABASE %I', :'langfuse_db_name')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'langfuse_db_name')
\gexec
