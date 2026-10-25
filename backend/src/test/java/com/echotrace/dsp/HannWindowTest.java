package com.echotrace.dsp;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class HannWindowTest {

    @Test
    @DisplayName("Hann window coefficients should satisfy symmetry, zero boundaries, and unit center")
    void testCoefficients() {
        int n = 1024;
        HannWindow window = new HannWindow(n);
        double[] coeffs = window.getCoefficients();

        assertThat(coeffs).hasSize(n);
        // Boundaries are 0
        assertThat(coeffs[0]).isCloseTo(0.0, org.assertj.core.data.Offset.offset(1e-6));
        assertThat(coeffs[n - 1]).isCloseTo(0.0, org.assertj.core.data.Offset.offset(1e-6));

        // Center approaches 1.0
        int center = (n - 1) / 2;
        assertThat(coeffs[center]).isCloseTo(1.0, org.assertj.core.data.Offset.offset(0.001));

        // Symmetry: w[i] == w[N - 1 - i]
        for (int i = 0; i < n / 2; i++) {
            assertThat(coeffs[i]).isCloseTo(coeffs[n - 1 - i], org.assertj.core.data.Offset.offset(1e-9));
        }
    }

    @Test
    @DisplayName("Should apply window correctly in-place and to destination buffer")
    void testApply() {
        int n = 8;
        HannWindow window = new HannWindow(n);

        double[] buffer = new double[]{1, 1, 1, 1, 1, 1, 1, 1};
        window.applyInPlace(buffer);

        assertThat(buffer[0]).isCloseTo(0.0, org.assertj.core.data.Offset.offset(1e-6));
        assertThat(buffer[n - 1]).isCloseTo(0.0, org.assertj.core.data.Offset.offset(1e-6));
        assertThat(buffer[3]).isGreaterThan(0.5);

        double[] source = new double[]{10, 10, 10, 10, 10, 10, 10, 10, 99};
        double[] dest = new double[n];
        window.apply(source, 0, dest);
        assertThat(dest[0]).isCloseTo(0.0, org.assertj.core.data.Offset.offset(1e-6));
    }

    @Test
    @DisplayName("Should reject invalid window sizes")
    void testInvalidSizes() {
        assertThatThrownBy(() -> new HannWindow(0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new HannWindow(1)).isInstanceOf(IllegalArgumentException.class);
    }
}
