import pytest

from chi_permits.tools.sql import validate_select


def test_validate_select_accepts_select():
    assert validate_select("select 1") == "select 1"


def test_validate_select_rejects_mutation():
    with pytest.raises(ValueError):
        validate_select("drop table permits")


def test_validate_select_ignores_keywords_in_strings():
    assert validate_select("select 'drop table permits' as text") == "select 'drop table permits' as text"
