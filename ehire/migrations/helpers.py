"""Small checks that keep a migration safe to run on a database that already has the change."""
from sqlalchemy import inspect


def has_table(connection, table):
    return inspect(connection).has_table(table)


def has_column(connection, table, column):
    if not has_table(connection, table):
        return False
    return column in {c["name"] for c in inspect(connection).get_columns(table)}


def has_index(connection, table, name):
    return name in {i["name"] for i in inspect(connection).get_indexes(table)}
