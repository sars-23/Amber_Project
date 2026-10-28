package com.amber;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class AmberApplication {

    public static void main(String[] args) {
        SpringApplication.run(AmberApplication.class, args);
    }
}
