# RiderBase – Database Systems Project  
**Team 006 – COSC 3380 (Fall 2025)**

---

## 1. Project Overview

RiderBase is a simplified ride-sharing platform designed to demonstrate complete database system development, including:

- Top–down ER modeling  
- Logical and physical schema design  
- Normalization up to BCNF  
- Concurrent and transaction-safe SQL  
- Implementation of multi-table ACID transactions  
- Realistic simulation of operational workflow  
- JavaScript web application backed by PostgreSQL

The system supports three actors:

- Riders: request rides, pay via card or wallet balance  
- Drivers: accept rides and receive payouts  
- Company: receives commissions, fees, and taxes  

The web application includes tools for:

- Database setup and initialization  
- Creating rides and quotations  
- Driver acceptance workflow  
- Bank account updates  
- Viewing ride history  
- Administrative actions (browse tables, truncate data, simulate rides)

---

## 2. ER Modeling – Top-Down Design

### 2.1 Draft Sketch (Brainstorming Phase)
Initial hand sketches were used to identify the main entities:
- Rider  
- Driver  
- Location  
- Category  
- Ride  
- Payment  

This step also established the basic operational sequence:
1. Rider requests a ride  
2. Driver accepts or rejects the request  
3. Company charges the rider  
4. Company allocates payouts and commissions  

### 2.2 Early Structured Model (Phase 1)
A preliminary UML diagram was created to refine attributes and relationships before normalization.

### 2.3 Final ERD (UML Notation)
The final schema was produced using dbdiagram.io and reflects full normalization, referential integrity, and operational flow.  
Key modeling decisions:

- `ride` links rider → driver → category → origin/dest locations  
- `payment` is a 1:1 extension of each ride  
- `bank_account` is unified for riders, drivers, and the company  
- `fare_rule` supports route-specific price overrides  
- `deduction_type` abstracts commission, tax, and fee percentages  

---

## 3. Logical Model (Normalized Tables)

All tables are normalized to **3NF or BCNF**.  
Below is the final logical model.

### Rider
| Column | Type | Notes |
|--------|-------|-------|
| rider_id (PK) | BIGSERIAL | Primary key |
| name | TEXT | Full name |
| email | TEXT | Unique |
| created_at | TIMESTAMP | Default now() |

### Driver
| Column | Type | Notes |
|--------|-------|-------|
| driver_id (PK) | BIGSERIAL |
| name | TEXT |
| email | TEXT |
| is_online | BOOLEAN |
| last_seen_at | TIMESTAMP |
| current_latitude | NUMERIC |
| current_longitude | NUMERIC |

### Location
| Column | Type | Notes |
|--------|-------|-------|
| location_id (PK) | BIGSERIAL |
| name | TEXT |
| latitude | NUMERIC |
| longitude | NUMERIC |
| is_hot_area | BOOLEAN |
| commission_discount_pct | NUMERIC |

### Category
| Column | Type |
|--------|-------|
| category_id (PK) | SERIAL |
| name | TEXT |
| rate_cents_per_mile | INT |

### Fare Rule
| Column | Type | Notes |
|--------|-------|-------|
| fare_rule_id (PK) | BIGSERIAL |
| category_id (FK) | INT |
| origin_location_id (FK) | INT |
| dest_location_id (FK) | INT |
| route_rate_cents_per_mile | INT |

### Deduction Type
| Column | Type |
|--------|-------|
| deduction_type_id (PK) | SERIAL |
| name (UNIQUE) | TEXT |
| default_pct | NUMERIC |

### Ride
Extensive table containing:
- Fare calculations  
- Distance  
- Percentage breakdowns  
- Commission splits  
- Full auditing of prices  

(Full list of columns included in original writeup.)

### Payment
| Column | Type |
|--------|-------|
| payment_id (PK) | BIGSERIAL |
| ride_id (FK) | BIGINT |
| method | TEXT |
| amount_total_cents | INT |
| status | TEXT |
| paid_at | TIMESTAMP |

### Bank Account
| Column | Type |
|--------|-------|
| account_id (PK) | SERIAL |
| owner_type | TEXT |
| rider_id | BIGINT (nullable) |
| driver_id | BIGINT (nullable) |
| balance_cents | INT |

---

## 4. Physical Model (SQL)

All schema DDL is stored in:

src/db/schema.sql

Features include:

- Referential integrity via foreign keys  
- Check constraints on ride statuses  
- Unique indexes on emails and deduction types  
- ON CONFLICT upserts where appropriate  

---

## 5. Queries and Transactions

All SQL logic for the project is consolidated into:

**`src/db/sql_all.sql`**

This file contains every ACID-safe transaction and all read-only query blocks used by the app.


### 5.1 Transaction Blocks (ACID-Safe)

**Transaction 1 — Rider Requests Ride**  
- Computes distance + fare  
- Applies deductions and hot-area discounts  
- Inserts a new ride  
- Inserts authorized payment  

Used in: `/api/rides/create`

**Transaction 2 — Driver Accepts Ride**  
- Locks ride (`SELECT FOR UPDATE`)  
- Wallet debit (if applicable)  
- Company + driver payouts  
- Ride set to `accepted`  

Used in: `/api/driver/accept`

**Transaction 3 — Admin Reset**  
- Deletes all rides  
- Resets all bank accounts  

Used in: `/api/admin/truncate` (ride)


**Transaction 4 — Clear Payments**  
Used in: `/api/admin/truncate` (payment)

**Transaction 5 — Update Hot-Area / Commission**  
Recomputes effective commission.  
Used in: `/api/location/hot-area`

**Transaction 6 — Upsert Deduction Types**  
Used in: `/api/deductions`

**Transaction 7 — Driver Online/Offline**  
Used in: `/api/driver/availability`

**Transaction 8 — Driver Rejects Ride**  
Used in: `/api/driver/reject`

## 5.2 Query Blocks

All queries stored in:  
**`src/db/sql_all.sql`**

**Admin Browse**  
Lists rows from any table.

**Location Commission Summary**  
Used in: `/api/location/hot-area/list`

**Company Stats**  
Used in: `/api/company/stats`

**Company Insights**  
Top routes, drivers, riders.

**Driver History**  
Used in: `/api/driver/history`

**Driver Glance**  
Wallet, earnings today, area.

**Pending Ride (Driver)**  
Used in: `/api/driver/pending`

**Metadata (riders, locations, categories)**  
Used in: `/api/meta`

**Nearest Online Driver**  
Used in: `/api/driver/nearest-driver`

**Fare Quote (No Write)**  
Used in: `/api/quote`

**Rider History + Wallet**  
Used in: `/api/rider/history`

---

## 6. Web Application (JavaScript)

Frameworks and technologies:

- Next.js (App Router)
- React + Tailwind CSS  
- PostgreSQL via `pg` Node.js client  

Major screens:

- Database setup page  
- Rider interface (request ride, history)  
- Driver interface (real-time request display and acceptance)  
- Company dashboard (revenue and payout reports)  
- Admin dashboard (browse tables, truncate tables, simulate rides)  

---

## 7. Simulation Feature

Simulation automatically generates a batch of randomized rides.  

Randomized input includes:

- Rider  
- Driver  
- Category  
- Origin & destination  
- Payment method (wallet/card)  

---

## 8. How to Run the Project

### Step 1 — Install PostgreSQL  
Create a database named:

createdb cosc3380

### Step 2 — Clone Repository  

git clone 
cd riderbase

### Step 3 — Install Dependencies  

npm install

### Step 4 — Run Dev Server  

npm run dev

### Step 5 — Access Application  
Open:

http://localhost:3000

### Step 6 — Enter DB Credentials  
Use:

- host: 127.0.0.1  
- port: 5432 (or your local Postgres.app port)  
- database: cosc3380  
- user: your OS user  
- password: your Postgres password  

After entering credentials, press **Initialize Database** to run schema + seed scripts.

---

## 9. File Structure

Example structure:

src/
app/
api/
rides/
drivers/
company/
admin/
db/
schema.sql
seed.sql
transaction.sql
query.sql
public/
images/
README.md

---