# Historical source schema

The SQL in this directory describes the former Supabase deployment and is retained only to document migration inputs. The active application uses versioned SQLite migrations in `backend/migrations`. Do not run this SQL during local installation. The one-time Python migration utility reads existing Supabase records/photos or imports the existing ZIP without modifying the source project.
