bool checkMin(num minValue, dynamic value) {
  num? parsedValue;

  if (value is num) {
    parsedValue = value;
  } else if (value is String) {
    parsedValue = num.tryParse(value);
  }

  if (parsedValue == null) {
    return false; // if cannot parse, return false
  }

  return parsedValue >= minValue;
}
