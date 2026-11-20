from django.db import migrations


def align_contact_column(apps, schema_editor):
    table_name = apps.get_model("core", "AgencyProfile")._meta.db_table
    connection = schema_editor.connection

    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(cursor, table_name)
        }

    if "contact_email" in columns and "contact_details" not in columns:
        quote_name = connection.ops.quote_name
        schema_editor.execute(
            f"ALTER TABLE {quote_name(table_name)} "
            f"RENAME COLUMN {quote_name('contact_email')} "
            f"TO {quote_name('contact_details')}"
        )


def reverse_align_contact_column(apps, schema_editor):
    table_name = apps.get_model("core", "AgencyProfile")._meta.db_table
    connection = schema_editor.connection

    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(cursor, table_name)
        }

    if "contact_details" in columns and "contact_email" not in columns:
        quote_name = connection.ops.quote_name
        schema_editor.execute(
            f"ALTER TABLE {quote_name(table_name)} "
            f"RENAME COLUMN {quote_name('contact_details')} "
            f"TO {quote_name('contact_email')}"
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(align_contact_column, reverse_align_contact_column),
    ]
