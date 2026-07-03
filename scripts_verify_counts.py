from chi_permits.db import connect

con = connect(read_only=True)
try:
    print("contacts", con.execute("select count(1) from contacts").fetchone()[0])
    print(
        "categories",
        con.execute(
            "select contact_category, count(1) from contacts group by contact_category order by count(1) desc"
        ).fetchall(),
    )
    print(
        "open permits",
        con.execute(
            "select count(1) from permits where permit_status in ('ACTIVE','SUSPENDED','PHASED PERMITTING')"
        ).fetchone()[0],
    )
finally:
    con.close()
