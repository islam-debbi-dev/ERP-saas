String cleanNumberString(String input) {
  // Try to parse as double
  double? number = double.tryParse(input);

  if (number == null) return input; // if not a valid number, return as is

  // If it's an integer (no decimal part)
  if (number == number.toInt()) {
    return number.toInt().toString();
  } else {
    return number.toString();
  }
}
