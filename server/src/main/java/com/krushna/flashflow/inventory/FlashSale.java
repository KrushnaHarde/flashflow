package com.krushna.flashflow.inventory;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "flash_sales")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FlashSale {

    @Id
    @Column(name = "sale_id", updatable = false, nullable = false)
    private UUID saleId;

    @Column(nullable = false)
    private String name;

    @Column(name = "start_time", nullable = false)
    private LocalDateTime startTime;

    @Column(name = "end_time")
    private LocalDateTime endTime;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(
        name = "flash_sale_products",
        joinColumns = @JoinColumn(name = "sale_id")
    )
    @Column(name = "product_id")
    private Set<UUID> productIds;
}
